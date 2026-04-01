import type { FastifyReply, FastifyRequest } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import type { GenerateRequestInput, PdfIdParams, MergeRequestInput } from './schema.js';
import type { PdfService } from '../../services/pdf/PdfService.js';
import type { StorageService } from '../../services/storage/StorageService.js';
import type { MetricsService } from '../../services/metrics/MetricsService.js';

export function createGetHandler(storageService: StorageService) {
  return async function getHandler(
    request: FastifyRequest<{ Params: PdfIdParams }>,
    reply: FastifyReply,
  ) {
    const { id } = request.params;
    const url = await storageService.getUrl(id);
    return reply.send({ statusCode: 200, data: { url } });
  };
}

export function createDeleteHandler(storageService: StorageService) {
  return async function deleteHandler(
    request: FastifyRequest<{ Params: PdfIdParams }>,
    reply: FastifyReply,
  ) {
    const { id } = request.params;
    await storageService.delete(id);
    return reply.code(204).send();
  };
}

export function createMergeHandler(storageService: StorageService) {
  return async function mergeHandler(
    request: FastifyRequest<{ Body: MergeRequestInput }>,
    reply: FastifyReply,
  ) {
    const { ids, stream } = request.body;

    const pdfBuffers = await Promise.all(ids.map((id) => storageService.download(id)));

    const mergedPdf = await PDFDocument.create();
    for (const pdfBuffer of pdfBuffers) {
      const pdf = await PDFDocument.load(pdfBuffer);
      const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices());
      pages.forEach((page) => mergedPdf.addPage(page));
    }
    const mergedBuffer = Buffer.from(await mergedPdf.save());

    if (stream) {
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="merged.pdf"')
        .send(mergedBuffer);
    }

    const url = await storageService.upload(mergedBuffer);
    return reply.send({ statusCode: 200, data: { url } });
  };
}

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
