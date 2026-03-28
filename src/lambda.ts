import awsLambdaFastify from 'aws-lambda-fastify';
import { buildApp } from './server.js';

// buildApp() is called at module level (outside the handler) so the browser
// is launched once and reused across warm invocations.
const app = await buildApp();
const proxy = awsLambdaFastify(app);

export const handler = proxy;
