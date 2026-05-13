import sharp from "sharp";
import { EMBEDDING_CONTRACT } from "@/lib/architecture-contract";

export type ImageTensor = {
  data: Float32Array;
  dims: [number, number, number, number];
};

export async function preprocessImageForEmbedding(
  source: string | Buffer | Uint8Array,
): Promise<ImageTensor> {
  const width = EMBEDDING_CONTRACT.imageSize.width;
  const height = EMBEDDING_CONTRACT.imageSize.height;
  const channels = 3;

  const raw = await sharp(source as Parameters<typeof sharp>[0])
    .rotate()
    .resize(width, height, {
      fit: "cover",
      position: "centre",
    })
    .removeAlpha()
    .toColorspace("srgb")
    .raw()
    .toBuffer();

  if (raw.length !== width * height * channels) {
    throw new Error(`Expected ${width * height * channels} RGB bytes, received ${raw.length}.`);
  }

  const tensor = new Float32Array(channels * width * height);
  const planeSize = width * height;

  for (let pixelIndex = 0; pixelIndex < planeSize; pixelIndex += 1) {
    const rawIndex = pixelIndex * channels;

    for (let channel = 0; channel < channels; channel += 1) {
      tensor[channel * planeSize + pixelIndex] = raw[rawIndex + channel] / 255;
    }
  }

  return {
    data: tensor,
    dims: [1, channels, height, width],
  };
}
