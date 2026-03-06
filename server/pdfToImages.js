const pdfjs = require("pdfjs-dist/legacy/build/pdf.js");

const SCALE = 1.5;
const MAX_PAGES = 30;

class NodeCanvasFactory {
  create(width, height) {
    const { createCanvas } = require("canvas");
    const canvas = createCanvas(width, height);
    const context = canvas.getContext("2d");
    return { canvas, context };
  }

  reset(canvasAndContext, width, height) {
    canvasAndContext.canvas.width = width;
    canvasAndContext.canvas.height = height;
  }

  destroy(canvasAndContext) {
    canvasAndContext.canvas.width = 0;
    canvasAndContext.canvas.height = 0;
  }
}

async function pdfBufferToImages(buffer) {
  const loadingTask = pdfjs.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
    useWorkerFetch: false,
    isEvalSupported: false,
    stopAtErrors: false
  });

  const document = await loadingTask.promise;
  const pageCount = Math.min(document.numPages, MAX_PAGES);
  const factory = new NodeCanvasFactory();
  const images = [];

  for (let i = 1; i <= pageCount; i++) {
    const page = await document.getPage(i);
    const viewport = page.getViewport({ scale: SCALE });
    const canvasAndContext = factory.create(
      Math.floor(viewport.width),
      Math.floor(viewport.height)
    );

    await page.render({
      canvasContext: canvasAndContext.context,
      viewport,
      canvasFactory: factory
    }).promise;

    const pngBuffer = canvasAndContext.canvas.toBuffer("image/png");
    images.push(pngBuffer.toString("base64"));

    factory.destroy(canvasAndContext);
    page.cleanup();
  }

  await document.destroy();
  return images;
}

module.exports = { pdfBufferToImages };
