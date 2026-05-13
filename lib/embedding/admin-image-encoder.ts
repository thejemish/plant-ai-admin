import { EMBEDDING_CONTRACT } from "@/lib/architecture-contract";
import { preprocessImageForEmbedding } from "@/lib/embedding/image-preprocess";
import { assertEmbeddingContract, l2Normalize } from "@/lib/embedding/vector";

type OrtModule = typeof import("onnxruntime-node");
type OrtSession = import("onnxruntime-node").InferenceSession;

export type AdminImageEmbedderOptions = {
  modelPath: string;
  inputName?: string;
  outputName?: string;
};

export type AdminImageEmbedder = {
  embed(imagePath: string): Promise<Float32Array>;
  embedSource(source: string | Buffer | Uint8Array): Promise<Float32Array>;
};

export async function createAdminImageEmbedder(options: AdminImageEmbedderOptions): Promise<AdminImageEmbedder> {
  const ort = await import("onnxruntime-node");
  const session = await ort.InferenceSession.create(options.modelPath);
  const inputName = options.inputName ?? session.inputNames[0];
  const outputName = options.outputName ?? session.outputNames[0];

  if (!inputName || !outputName) {
    throw new Error("The ONNX model must expose at least one input and one output tensor.");
  }

  return {
    async embed(imagePath: string) {
      return embedImageWithSession({
        source: imagePath,
        inputName,
        outputName,
        ort,
        session,
      });
    },
    async embedSource(source: string | Buffer | Uint8Array) {
      return embedImageWithSession({
        source,
        inputName,
        outputName,
        ort,
        session,
      });
    },
  };
}

async function embedImageWithSession({
  source,
  inputName,
  outputName,
  ort,
  session,
}: {
  source: string | Buffer | Uint8Array;
  inputName: string;
  outputName: string;
  ort: OrtModule;
  session: OrtSession;
}) {
  const tensor = await preprocessImageForEmbedding(source);
  const feeds = {
    [inputName]: new ort.Tensor("float32", tensor.data, tensor.dims),
  };

  const outputs = await session.run(feeds);
  const output = outputs[outputName];

  if (!output || !(output.data instanceof Float32Array)) {
    throw new Error(`Model output "${outputName}" did not return Float32Array data.`);
  }

  const embedding = l2Normalize(output.data);
  assertEmbeddingContract(embedding);

  return embedding;
}

export function assertEmbeddingMetadata(modelId: string, preprocessId: string, dim: number) {
  if (modelId !== EMBEDDING_CONTRACT.modelId) {
    throw new Error(`Expected model_id "${EMBEDDING_CONTRACT.modelId}", received "${modelId}".`);
  }

  if (preprocessId !== EMBEDDING_CONTRACT.preprocessId) {
    throw new Error(`Expected preprocess_id "${EMBEDDING_CONTRACT.preprocessId}", received "${preprocessId}".`);
  }

  if (dim !== EMBEDDING_CONTRACT.vectorDimension) {
    throw new Error(`Expected embedding dim ${EMBEDDING_CONTRACT.vectorDimension}, received ${dim}.`);
  }
}

