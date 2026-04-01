#!/usr/bin/env bash
# scripts/aws-setup.sh — Bootstrap AWS prerequisites for the folio SAM deployment pipeline
#
# Creates the resources that live outside the CloudFormation stack:
#   • GitHub OIDC identity provider
#   • github-actions-deploy IAM role (used by GitHub Actions to run sam deploy)
#   • ECR repository (SAM pushes images here)
#   • S3 bucket for SAM deployment artifacts
#   • S3 bucket for PDF storage (managed outside the stack to avoid accidental deletion)
#
# Everything else (Lambda, API Gateway, execution role) is managed by template.yaml.
#
# Prerequisites: aws CLI v2, git; gh CLI (optional — for setting secrets)
# Usage: ./scripts/aws-setup.sh

set -euo pipefail

# ── Colours ───────────────────────────────────────────────────────────────────

bold=$'\e[1m'; reset=$'\e[0m'
green=$'\e[32m'; red=$'\e[31m'; yellow=$'\e[33m'; blue=$'\e[34m'

info()    { printf '%s==>%s %s\n'   "$blue"   "$reset" "$*"; }
success() { printf '%s✓%s  %s\n'    "$green"  "$reset" "$*"; }
warn()    { printf '%s!%s  %s\n'    "$yellow" "$reset" "$*"; }
die()     { printf '%s✗%s  %s\n'    "$red"    "$reset" "$*" >&2; exit 1; }

# Wrapper — injects --profile on every aws call once AWS_PROFILE is set.
# Falls back to the ambient credentials for check_prereqs (aws --version).
aws() {
  if [ -n "${AWS_PROFILE:-}" ]; then
    command aws --profile "$AWS_PROFILE" "$@"
  else
    command aws "$@"
  fi
}

# ── Prerequisites ─────────────────────────────────────────────────────────────

check_prereqs() {
  local missing=()
  for cmd in aws git jq; do
    command -v "$cmd" &>/dev/null || missing+=("$cmd")
  done
  [ "${#missing[@]}" -eq 0 ] || die "Missing prerequisites: ${missing[*]}"

  local aws_ver
  aws_ver=$(aws --version 2>&1 | sed 's/aws-cli\/\([0-9]*\).*/\1/')
  [ "${aws_ver:-0}" -ge 2 ] || die "aws CLI v2 required (got: $(aws --version 2>&1))"
}

# ── Configuration ─────────────────────────────────────────────────────────────

REGION="eu-central-1"
ECR_REPOSITORY="folio"
PDF_BUCKET=""
AWS_ACCOUNT_ID=""
GITHUB_ORG_REPO=""
API_KEY_VALUE=""

pick_aws_profile() {
  # List profiles from ~/.aws/config (strips the "profile " prefix)
  local profiles=()
  if [ -f "$HOME/.aws/config" ]; then
    while IFS= read -r line; do
      profiles+=("$line")
    done < <(sed -n 's/^\[profile \(.*\)\]/\1/p' "$HOME/.aws/config")
    # Always include "default" if present
    if grep -q '^\[default\]' "$HOME/.aws/config" 2>/dev/null; then
      profiles=("default" "${profiles[@]}")
    fi
  fi

  echo
  if [ "${#profiles[@]}" -gt 0 ]; then
    printf '%sAvailable AWS profiles%s\n' "$bold" "$reset"
    for i in "${!profiles[@]}"; do
      printf '  [%d] %s\n' "$((i+1))" "${profiles[$i]}"
    done
    echo
    read -rp "AWS profile [default]: " _in
  else
    read -rp "AWS profile [default]: " _in
  fi

  AWS_PROFILE="${_in:-default}"
  success "Using AWS profile: $AWS_PROFILE"
}

detect_config() {
  info "Detecting configuration..."

  AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text) \
    || die "Could not reach AWS. Check credentials for profile '${AWS_PROFILE:-default}'."

  local remote_url
  remote_url=$(git remote get-url origin 2>/dev/null || echo "")
  if [[ "$remote_url" =~ github\.com[:/]([^/]+/[^/.]+?)(\.git)?$ ]]; then
    GITHUB_ORG_REPO="${BASH_REMATCH[1]}"
  fi
}

prompt_config() {
  echo
  printf '%sConfiguration%s\n' "$bold" "$reset"
  echo "─────────────────────────────────────────────"

  read -rp "GitHub repo   [${GITHUB_ORG_REPO:-owner/repo}]: " _in
  GITHUB_ORG_REPO="${_in:-$GITHUB_ORG_REPO}"
  [ -n "$GITHUB_ORG_REPO" ] || die "GitHub repo is required"

  read -rp "ECR repo name [$ECR_REPOSITORY]: " _in
  ECR_REPOSITORY="${_in:-$ECR_REPOSITORY}"

  local pdf_default="folio-pdfs-${AWS_ACCOUNT_ID}"
  read -rp "S3 bucket for PDFs [$pdf_default]: " _in
  PDF_BUCKET="${_in:-$pdf_default}"

  read -rp "API key (≥32 chars, blank = no auth): " API_KEY_VALUE

  # SAM artifact bucket: deterministic name based on account id
  SAM_ARTIFACT_BUCKET="folio-sam-${AWS_ACCOUNT_ID}"

  echo
  printf '  %-24s %s\n' "AWS account ID:"      "$AWS_ACCOUNT_ID"
  printf '  %-24s %s\n' "Region:"              "$REGION"
  printf '  %-24s %s\n' "GitHub repo:"         "$GITHUB_ORG_REPO"
  printf '  %-24s %s\n' "ECR repository:"      "$ECR_REPOSITORY"
  printf '  %-24s %s\n' "PDF S3 bucket:"       "$PDF_BUCKET"
  printf '  %-24s %s\n' "SAM artifact bucket:" "$SAM_ARTIFACT_BUCKET"
  printf '  %-24s %s\n' "API key:"             "${API_KEY_VALUE:+(set)}"
  echo

  read -rp "Proceed? [y/N] " _confirm
  [[ "$_confirm" =~ ^[Yy]$ ]] || die "Aborted"
}

# ── OIDC Identity Provider ────────────────────────────────────────────────────

setup_oidc() {
  info "GitHub OIDC identity provider..."
  local arn="arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"

  if aws iam get-open-id-connect-provider --open-id-connect-provider-arn "$arn" &>/dev/null; then
    success "OIDC provider already exists"
    return
  fi

  # AWS validates GitHub OIDC via JWKs; thumbprint is a required field but not
  # used for verification against github.com.
  aws iam create-open-id-connect-provider \
    --url "https://token.actions.githubusercontent.com" \
    --client-id-list "sts.amazonaws.com" \
    --thumbprint-list "6938fd4d98bab03faadb97b34396831e3780aea1" \
    >/dev/null

  success "OIDC provider created"
}

# ── github-actions-deploy IAM role ───────────────────────────────────────────

setup_deploy_role() {
  info "github-actions-deploy IAM role..."

  local trust
  trust=$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Effect": "Allow",
    "Principal": {
      "Federated": "arn:aws:iam::${AWS_ACCOUNT_ID}:oidc-provider/token.actions.githubusercontent.com"
    },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": {
        "token.actions.githubusercontent.com:aud": "sts.amazonaws.com"
      },
      "StringLike": {
        "token.actions.githubusercontent.com:sub": "repo:${GITHUB_ORG_REPO}:*"
      }
    }
  }]
}
JSON
)

  if aws iam get-role --role-name "github-actions-deploy" &>/dev/null; then
    success "Role github-actions-deploy already exists"
  else
    aws iam create-role \
      --role-name "github-actions-deploy" \
      --assume-role-policy-document "$trust" \
      --tags Key=managedBy,Value=aws-setup.sh \
      >/dev/null
    success "Created role github-actions-deploy"
  fi

  # Inline policy — scoped to the folio stack and related resources
  aws iam put-role-policy \
    --role-name "github-actions-deploy" \
    --policy-name "sam-deploy" \
    --policy-document "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "CloudFormation",
      "Effect": "Allow",
      "Action": "cloudformation:*",
      "Resource": [
        "arn:aws:cloudformation:${REGION}:${AWS_ACCOUNT_ID}:stack/folio/*",
        "arn:aws:cloudformation:${REGION}:aws:transform/Serverless-2016-10-31"
      ]
    },
    {
      "Sid": "CloudFormationList",
      "Effect": "Allow",
      "Action": ["cloudformation:ListStacks", "cloudformation:ValidateTemplate"],
      "Resource": "*"
    },
    {
      "Sid": "SamArtifactBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:ListBucket", "s3:GetBucketLocation"],
      "Resource": [
        "arn:aws:s3:::${SAM_ARTIFACT_BUCKET}",
        "arn:aws:s3:::${SAM_ARTIFACT_BUCKET}/*"
      ]
    },
    {
      "Sid": "Ecr",
      "Effect": "Allow",
      "Action": "ecr:GetAuthorizationToken",
      "Resource": "*"
    },
    {
      "Sid": "EcrPush",
      "Effect": "Allow",
      "Action": [
        "ecr:BatchCheckLayerAvailability",
        "ecr:PutImage",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:DescribeRepositories",
        "ecr:DescribeImages"
      ],
      "Resource": "arn:aws:ecr:${REGION}:${AWS_ACCOUNT_ID}:repository/${ECR_REPOSITORY}"
    },
    {
      "Sid": "Lambda",
      "Effect": "Allow",
      "Action": "lambda:*",
      "Resource": "arn:aws:lambda:${REGION}:${AWS_ACCOUNT_ID}:function:folio*"
    },
    {
      "Sid": "IamFolioRoles",
      "Effect": "Allow",
      "Action": [
        "iam:CreateRole", "iam:DeleteRole", "iam:GetRole", "iam:TagRole",
        "iam:AttachRolePolicy", "iam:DetachRolePolicy",
        "iam:PutRolePolicy", "iam:DeleteRolePolicy", "iam:GetRolePolicy"
      ],
      "Resource": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/folio*"
    },
    {
      "Sid": "IamPassRole",
      "Effect": "Allow",
      "Action": "iam:PassRole",
      "Resource": "arn:aws:iam::${AWS_ACCOUNT_ID}:role/folio*",
      "Condition": {
        "StringEquals": {"iam:PassedToService": "lambda.amazonaws.com"}
      }
    },
    {
      "Sid": "ApiGateway",
      "Effect": "Allow",
      "Action": "apigateway:*",
      "Resource": "arn:aws:apigateway:${REGION}::/*"
    }
  ]
}
JSON
)"

  success "Deploy policy attached"
}

# ── S3 Buckets ────────────────────────────────────────────────────────────────

create_private_bucket() {
  local bucket="$1" label="$2"

  local args=(--bucket "$bucket" --region "$REGION")
  [ "$REGION" != "us-east-1" ] && \
    args+=(--create-bucket-configuration LocationConstraint="$REGION")

  local err
  if err=$(aws s3api create-bucket "${args[@]}" 2>&1); then
    aws s3api put-public-access-block \
      --bucket "$bucket" \
      --public-access-block-configuration \
        "BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true"
    success "$label $bucket created"
  elif echo "$err" | grep -q "BucketAlreadyOwnedByYou"; then
    success "$label $bucket already exists"
  elif echo "$err" | grep -q "BucketAlreadyExists"; then
    die "$label name '$bucket' is taken by another AWS account — choose a different name"
  else
    die "$err"
  fi
}

setup_buckets() {
  info "S3 buckets..."
  create_private_bucket "$PDF_BUCKET"          "PDF bucket"
  create_private_bucket "$SAM_ARTIFACT_BUCKET" "SAM artifact bucket"
}

# ── ECR Repository ────────────────────────────────────────────────────────────

setup_ecr() {
  info "ECR repository..."

  if aws ecr describe-repositories \
     --repository-names "$ECR_REPOSITORY" \
     --region "$REGION" &>/dev/null; then
    success "ECR repository $ECR_REPOSITORY already exists"
    return
  fi

  aws ecr create-repository \
    --repository-name "$ECR_REPOSITORY" \
    --region "$REGION" \
    --image-scanning-configuration scanOnPush=true \
    --tags Key=managedBy,Value=aws-setup.sh \
    >/dev/null

  success "ECR repository $ECR_REPOSITORY created"

  _set_ecr_policy
}

_set_ecr_policy() {
  aws ecr set-repository-policy \
    --repository-name "$ECR_REPOSITORY" \
    --region "$REGION" \
    --policy-text "$(cat <<JSON
{
  "Version": "2012-10-17",
  "Statement": [{
    "Sid": "LambdaECRAccess",
    "Effect": "Allow",
    "Principal": {"Service": "lambda.amazonaws.com"},
    "Action": ["ecr:BatchGetImage", "ecr:GetDownloadUrlForLayer"]
  }]
}
JSON
)" >/dev/null
  success "ECR repository policy set (Lambda pull access)"
}

# ── GitHub Secrets ────────────────────────────────────────────────────────────

configure_secrets() {
  echo
  printf '%sGitHub Secrets%s\n' "$bold" "$reset"
  echo "─────────────────────────────────────────────"
  printf '  %-24s %s\n' "AWS_ACCOUNT_ID"      "$AWS_ACCOUNT_ID"
  printf '  %-24s %s\n' "ECR_REPOSITORY"      "$ECR_REPOSITORY"
  printf '  %-24s %s\n' "S3_BUCKET_NAME"      "$PDF_BUCKET"
  printf '  %-24s %s\n' "SAM_ARTIFACT_BUCKET" "$SAM_ARTIFACT_BUCKET"
  printf '  %-24s %s\n' "API_KEY"             "${API_KEY_VALUE:+(set)}"
  echo

  if command -v gh &>/dev/null; then
    read -rp "Set these as GitHub secrets via gh CLI now? [y/N] " _set
    if [[ "$_set" =~ ^[Yy]$ ]]; then
      gh secret set AWS_ACCOUNT_ID      --body "$AWS_ACCOUNT_ID"
      gh secret set ECR_REPOSITORY      --body "$ECR_REPOSITORY"
      gh secret set S3_BUCKET_NAME      --body "$PDF_BUCKET"
      gh secret set SAM_ARTIFACT_BUCKET --body "$SAM_ARTIFACT_BUCKET"
      [ -n "$API_KEY_VALUE" ] && gh secret set API_KEY --body "$API_KEY_VALUE"
      success "Secrets set in $GITHUB_ORG_REPO"
    fi
  else
    warn "gh CLI not found — set the secrets above manually in repo Settings → Secrets."
  fi
}

# ── Main ──────────────────────────────────────────────────────────────────────

main() {
  echo
  printf '%sfolio AWS Prerequisites Setup%s\n' "$bold" "$reset"
  echo "═════════════════════════════════════════════"
  echo

  check_prereqs
  pick_aws_profile
  detect_config
  prompt_config

  echo
  setup_oidc
  setup_deploy_role
  setup_buckets
  setup_ecr
  configure_secrets

  echo
  printf '%s✓ Done%s\n' "$green" "$reset"
  echo
  echo "  Push to main and the GitHub Actions workflow will run sam deploy."
  echo
  printf '%sLocal deployment%s\n' "$bold" "$reset"
  echo "  1. Fill in the placeholders in samconfig.toml"
  echo "  2. sam build && sam deploy"
  echo
}

main "$@"
