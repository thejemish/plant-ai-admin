import { EMBEDDING_CONTRACT } from "@/lib/architecture-contract";

export type ReferenceEmbedding = {
  sampleId: string;
  diseaseId: string;
  diseaseLabel: string;
  crop: string;
  embedding: Float32Array;
};

export type RetrievalMatch = ReferenceEmbedding & {
  score: number;
};

export type LabeledQuery = {
  id: string;
  expectedDiseaseId: string;
  embedding: Float32Array;
};

export type RetrievalReport = {
  queryCount: number;
  top1Accuracy: number;
  top3Accuracy: number;
  meanReciprocalRank: number;
};

export function assertEmbeddingContract(vector: Float32Array) {
  if (vector.length !== EMBEDDING_CONTRACT.vectorDimension) {
    throw new Error(
      `Expected ${EMBEDDING_CONTRACT.vectorDimension}-dim embedding, received ${vector.length}.`,
    );
  }
}

export function l2Normalize(vector: Float32Array) {
  let sumSquares = 0;

  for (const value of vector) {
    sumSquares += value * value;
  }

  const magnitude = Math.sqrt(sumSquares);

  if (!Number.isFinite(magnitude) || magnitude === 0) {
    throw new Error("Cannot normalize an empty or zero-magnitude embedding.");
  }

  const normalized = new Float32Array(vector.length);

  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / magnitude;
  }

  return normalized;
}

export function cosineSimilarity(left: Float32Array, right: Float32Array) {
  if (left.length !== right.length) {
    throw new Error(`Cannot compare embeddings with dimensions ${left.length} and ${right.length}.`);
  }

  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;

  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index];
    leftNorm += left[index] * left[index];
    rightNorm += right[index] * right[index];
  }

  if (leftNorm === 0 || rightNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export function topKSimilar(
  queryEmbedding: Float32Array,
  references: ReferenceEmbedding[],
  count: number,
): RetrievalMatch[] {
  assertEmbeddingContract(queryEmbedding);

  return references
    .map((reference) => {
      assertEmbeddingContract(reference.embedding);

      return {
        ...reference,
        score: cosineSimilarity(queryEmbedding, reference.embedding),
      };
    })
    .sort((left, right) => right.score - left.score)
    .slice(0, count);
}

export function evaluateRetrieval(
  queries: LabeledQuery[],
  references: ReferenceEmbedding[],
): RetrievalReport {
  if (queries.length === 0) {
    return {
      queryCount: 0,
      top1Accuracy: 0,
      top3Accuracy: 0,
      meanReciprocalRank: 0,
    };
  }

  let top1Hits = 0;
  let top3Hits = 0;
  let reciprocalRankSum = 0;

  for (const query of queries) {
    const matches = topKSimilar(query.embedding, references, references.length);
    const rank = matches.findIndex((match) => match.diseaseId === query.expectedDiseaseId);

    if (rank === 0) {
      top1Hits += 1;
    }

    if (rank >= 0 && rank < 3) {
      top3Hits += 1;
    }

    if (rank >= 0) {
      reciprocalRankSum += 1 / (rank + 1);
    }
  }

  return {
    queryCount: queries.length,
    top1Accuracy: top1Hits / queries.length,
    top3Accuracy: top3Hits / queries.length,
    meanReciprocalRank: reciprocalRankSum / queries.length,
  };
}

export function float32ArrayToBase64(vector: Float32Array) {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength).toString("base64");
}

export function base64ToFloat32Array(value: string) {
  const buffer = Buffer.from(value, "base64");
  return new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / Float32Array.BYTES_PER_ELEMENT);
}

export function isSupportedImageFile(fileName: string) {
  return /\.(jpe?g|png|webp)$/i.test(fileName);
}
