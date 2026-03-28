import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GenerateRequestInput } from './schema.js';
import type { PdfService } from '../../services/pdf/PdfService.js';
import type { StorageService } from '../../services/storage/StorageService.js';

export function createGenerateHandler(
  pdfService: PdfService,
  storageService: StorageService,
) {
  return async function generateHandler(
    request: FastifyRequest<{ Body: GenerateRequestInput }>,
    reply: FastifyReply,
  ) {
    const { html, paper, options, stream } = request.body;

    const pdfBuffer = await pdfService.generate(html, paper, options);

    if (stream) {
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="document.pdf"')
        .send(pdfBuffer);
    }

    const url = await storageService.upload(pdfBuffer);

    return reply.send({
      statusCode: 200,
      data: { url },
    });
  };
}
