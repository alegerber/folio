declare module 'aws-lambda-fastify' {
  import type { FastifyInstance } from 'fastify';
  import type { Handler } from 'aws-lambda';

  function awsLambdaFastify(
    app: FastifyInstance,
    options?: {
      binaryMimeTypes?: string[];
      serializeLambdaArguments?: boolean;
      retainStage?: boolean;
      decorateRequest?: boolean;
      callbackWaitsForEmptyEventLoop?: boolean;
    },
  ): Handler;

  export default awsLambdaFastify;
}
