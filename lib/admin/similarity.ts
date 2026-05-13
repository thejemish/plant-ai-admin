import { base64ToFloat32Array, cosineSimilarity } from "@/lib/embedding/vector";

export type EmbeddingCandidate = {
  sampleId: string;
  crop: string;
  diseaseLabel: string;
  status: string;
  verified: boolean;
  embeddingBase64: string;
};

export type SimilarityReviewRow = {
  leftSampleId: string;
  rightSampleId: string;
  crop: string;
  leftDiseaseLabel: string;
  rightDiseaseLabel: string;
  score: number;
  recommendation: string;
};

export function buildSimilarityReviews(candidates: EmbeddingCandidate[], limit = 10): SimilarityReviewRow[] {
  const rows: SimilarityReviewRow[] = [];

  for (let leftIndex = 0; leftIndex < candidates.length; leftIndex += 1) {
    const left = candidates[leftIndex];
    const leftEmbedding = base64ToFloat32Array(left.embeddingBase64);

    for (let rightIndex = leftIndex + 1; rightIndex < candidates.length; rightIndex += 1) {
      const right = candidates[rightIndex];

      if (left.crop !== right.crop) {
        continue;
      }

      const score = cosineSimilarity(leftEmbedding, base64ToFloat32Array(right.embeddingBase64));
      rows.push({
        leftSampleId: left.sampleId,
        rightSampleId: right.sampleId,
        crop: left.crop,
        leftDiseaseLabel: left.diseaseLabel,
        rightDiseaseLabel: right.diseaseLabel,
        score,
        recommendation: recommendationForScore(score, left.diseaseLabel === right.diseaseLabel),
      });
    }
  }

  return rows.sort((left, right) => right.score - left.score).slice(0, limit);
}

function recommendationForScore(score: number, sameLabel: boolean) {
  if (score >= 0.97 && sameLabel) {
    return "likely duplicate";
  }

  if (score >= 0.92 && !sameLabel) {
    return "label conflict";
  }

  if (score >= 0.85) {
    return "review";
  }

  return "ok";
}
