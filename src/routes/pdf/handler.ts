import type { FastifyReply, FastifyRequest } from 'fastify';
import { PDFDocument } from 'pdf-lib';
import type {
  GenerateRequestInput,
  PdfIdParams,
  MergeRequestInput,
  SplitRequestInput,
  CompressRequestInput,
  PdfARequestInput,
} from './schema.js';
import type { PdfService } from '../../services/pdf/PdfService.js';
import type { StorageService, StoredPdf } from '../../services/storage/StorageService.js';
import type { MetricsService } from '../../services/metrics/MetricsService.js';
import type { PdfOperationsService } from '../../services/pdf/PdfOperationsService.js';

function sendStoredPdf(reply: FastifyReply, storedPdf: StoredPdf) {
  return reply.send({ statusCode: 200, data: storedPdf });
}

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

    const storedPdf = await storageService.upload(mergedBuffer);
    return sendStoredPdf(reply, storedPdf);
  };
}

export function createSplitHandler(storageService: StorageService, opsService: PdfOperationsService) {
  return async function splitHandler(
    request: FastifyRequest<{ Body: SplitRequestInput }>,
    reply: FastifyReply,
  ) {
    const { id, pages, stream } = request.body;
    const sourceBytes = await storageService.download(id);
    const resultBuffer = await opsService.split(sourceBytes, pages);
    if (stream) {
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="split.pdf"')
        .send(resultBuffer);
    }
    const storedPdf = await storageService.upload(resultBuffer);
    return sendStoredPdf(reply, storedPdf);
  };
}

export function createCompressHandler(storageService: StorageService, opsService: PdfOperationsService) {
  return async function compressHandler(
    request: FastifyRequest<{ Body: CompressRequestInput }>,
    reply: FastifyReply,
  ) {
    const { id, stream } = request.body;
    const sourceBytes = await storageService.download(id);
    const resultBuffer = await opsService.compress(sourceBytes);
    if (stream) {
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="compressed.pdf"')
        .send(resultBuffer);
    }
    const storedPdf = await storageService.upload(resultBuffer);
    return sendStoredPdf(reply, storedPdf);
  };
}

export function createPdfAHandler(storageService: StorageService, opsService: PdfOperationsService) {
  return async function pdfAHandler(
    request: FastifyRequest<{ Body: PdfARequestInput }>,
    reply: FastifyReply,
  ) {
    const { id, conformance, stream } = request.body;
    const sourceBytes = await storageService.download(id);
    const resultBuffer = await opsService.convertToPdfA(sourceBytes, conformance);
    if (stream) {
      return reply
        .header('Content-Type', 'application/pdf')
        .header('Content-Disposition', 'attachment; filename="pdfa.pdf"')
        .send(resultBuffer);
    }
    const storedPdf = await storageService.upload(resultBuffer);
    return sendStoredPdf(reply, storedPdf);
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

    try {
      const pdfBuffer = await pdfService.generate(html, css, paper, options);

      if (stream) {
        metricsService.recordSuccess(Date.now() - start, pdfBuffer.length);
        return reply
          .header('Content-Type', 'application/pdf')
          .header('Content-Disposition', 'attachment; filename="document.pdf"')
          .send(pdfBuffer);
      }

      const storedPdf = await storageService.upload(pdfBuffer);
      metricsService.recordSuccess(Date.now() - start, pdfBuffer.length);

      return sendStoredPdf(reply, storedPdf);
    } catch (err) {
      metricsService.recordError();
      throw err;
    }
  };
}
