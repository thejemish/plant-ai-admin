export const CORE_ARCHITECTURE_DECISIONS = [
  {
    decision: "Primary scan decision",
    value: "Image embedding similarity, not Gemma",
  },
  {
    decision: "Default embedding model",
    value: "MobileCLIP-S0",
  },
  {
    decision: "Admin/mobile parity",
    value: "Same model, preprocessing, normalization, and vector dimension",
  },
  {
    decision: "Canonical backend",
    value: "Supabase content tables plus storage for reference assets",
  },
  {
    decision: "Offline mobile store",
    value: "Supastash-synced SQLite content and embeddings",
  },
  {
    decision: "Gemma responsibility",
    value: "Explain retrieved evidence and answer follow-up questions",
  },
] as const;

export const EMBEDDING_CONTRACT = {
  modelId: "mobileclip-s0",
  preprocessId: "mobileclip-s0-256-rgb-center-crop-rescale-v1",
  imageSize: {
    width: 256,
    height: 256,
  },
  inputColorSpace: "rgb",
  resizeMode: "resize-shorter-side-then-center-crop",
  pixelValueRange: "0_to_1_float32",
  normalization: null,
  vectorDimension: 512,
  outputNormalization: "l2_unit_length",
} as const;

export const SUPABASE_TABLE_CONTRACT = [
  {
    table: "crops",
    purpose: "Crop names, aliases, family, status, and display metadata.",
    syncKey: "id",
    requiredForOfflineScan: true,
  },
  {
    table: "diseases",
    purpose: "Disease metadata, symptoms, severity rules, and review status.",
    syncKey: "id",
    requiredForOfflineScan: true,
  },
  {
    table: "disease_treatments",
    purpose: "Organic, chemical, cultural, and prevention guidance.",
    syncKey: "id",
    requiredForOfflineScan: true,
  },
  {
    table: "leaf_samples",
    purpose: "Verified reference image metadata for evidence and ranking.",
    syncKey: "id",
    requiredForOfflineScan: true,
  },
  {
    table: "leaf_sample_embeddings",
    purpose: "Base64 Float32 MobileCLIP vectors keyed by leaf sample.",
    syncKey: "sample_id",
    requiredForOfflineScan: true,
  },
  {
    table: "guide_chunks",
    purpose: "Tagged guide text for citations and grounded answers.",
    syncKey: "id",
    requiredForOfflineScan: true,
  },
  {
    table: "translations",
    purpose: "Approved localized field text for offline labels and guidance.",
    syncKey: "id",
    requiredForOfflineScan: true,
  },
  {
    table: "crop_stage_rules",
    purpose: "Crop calendar rules for field context and stage-aware advice.",
    syncKey: "id",
    requiredForOfflineScan: true,
  },
  {
    table: "fields",
    purpose: "User-owned field records scoped by Supabase auth user.",
    syncKey: "id",
    requiredForOfflineScan: false,
  },
  {
    table: "scans",
    purpose: "User-owned scan reports, corrections, and optional shared uploads.",
    syncKey: "id",
    requiredForOfflineScan: false,
  },
] as const;

export const DEMO_SCOPE = {
  crops: [
    {
      id: "tomato",
      diseases: ["healthy", "early-blight", "late-blight"],
    },
    {
      id: "rice",
      diseases: ["healthy", "leaf-blast", "brown-spot"],
    },
  ],
  targetReferenceImagesPerDisease: 5,
  totalTargetReferenceImages: 30,
  languages: ["en", "hi", "gu"],
} as const;
