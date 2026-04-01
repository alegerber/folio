import type { FastifyReply, FastifyRequest } from 'fastify';
import type { GenerateRequestInput } from './schema.js';
import type { PdfService } from '../../services/pdf/PdfService.js';
import type { StorageService } from '../../services/storage/StorageService.js';
import type { MetricsService } from '../../services/metrics/MetricsService.js';

export function createGenerateHandler(
  pdfService: PdfService,
  storageService: StorageService,
  metricsService: MetricsService,
) {
  return async function generateHandler(
    request: FastifyRequest<{ Body: GenerateRequestInput }>,
    reply: FastifyReply,
  ) {
    const { html, css, paper, options, stream } = request.body;
    
    const start = Date.now();
    let pdfBuffer: Buffer;
    try {
      pdfBuffer = await pdfService.generate(html, css, paper, options);
    } catch (err) {
      metricsService.recordError();
      throw err;
    }
    metricsService.recordSuccess(Date.now() - start, pdfBuffer.length);

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
