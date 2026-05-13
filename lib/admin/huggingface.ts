export function getHuggingFaceToken() {
  return (
    process.env.HUGGINGFACE_TOKEN ??
    process.env.HF_TOKEN ??
    process.env.HUGGINGFACE_HUB_TOKEN ??
    null
  );
}

export const hasHuggingFaceToken = Boolean(getHuggingFaceToken());

export function getHuggingFaceAuthHeaders(): Record<string, string> {
  const token = getHuggingFaceToken();

  if (!token) {
    return {};
  }

  return {
    Authorization: `Bearer ${token}`,
  };
}
