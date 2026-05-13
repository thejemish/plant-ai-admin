import "server-only";

import { createHmac, createHash } from "node:crypto";
import { getSupabaseAdminClient } from "@/lib/admin/supabase";

type StoredObject = {
  publicUrl: string;
};

type UploadObjectOptions = {
  body: Buffer;
  contentType: string;
  key: string;
};

type R2Config = {
  accessKeyId: string;
  accountId: string;
  bucket: string;
  endpoint: string;
  publicUrl: string;
  secretAccessKey: string;
};

const R2_REGION = "auto";
const R2_SERVICE = "s3";

export function isR2StorageConfigured() {
  return Boolean(getR2Config());
}

export async function uploadLeafObject({ body, contentType, key }: UploadObjectOptions): Promise<StoredObject> {
  const r2Config = getR2Config();

  if (r2Config) {
    return uploadR2Object(r2Config, { body, contentType, key });
  }

  const supabase = getSupabaseAdminClient();

  if (!supabase) {
    throw new Error("Configure R2 env vars or SUPABASE_SERVICE_ROLE_KEY before uploading leaf assets.");
  }

  const { error } = await supabase.storage.from("leaves").upload(key, body, {
    contentType,
    upsert: false,
  });

  if (error) {
    throw new Error(error.message);
  }

  return {
    publicUrl: supabase.storage.from("leaves").getPublicUrl(key).data.publicUrl,
  };
}

function getR2Config(): R2Config | null {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  const publicUrl = process.env.R2_PUBLIC_URL;
  const endpoint = process.env.R2_ENDPOINT ?? (accountId ? `https://${accountId}.r2.cloudflarestorage.com` : "");

  if (!accountId && !process.env.R2_ENDPOINT) {
    return null;
  }

  if (!accessKeyId || !secretAccessKey || !bucket || !publicUrl || !endpoint) {
    throw new Error(
      "R2 storage is partially configured. Set R2_ACCOUNT_ID or R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET, and R2_PUBLIC_URL.",
    );
  }

  return {
    accessKeyId,
    accountId: accountId ?? "",
    bucket,
    endpoint: endpoint.replace(/\/+$/g, ""),
    publicUrl: publicUrl.replace(/\/+$/g, ""),
    secretAccessKey,
  };
}

async function uploadR2Object(
  config: R2Config,
  { body, contentType, key }: UploadObjectOptions,
): Promise<StoredObject> {
  const encodedKey = key.split("/").map(encodeURIComponent).join("/");
  const url = new URL(`${config.endpoint}/${config.bucket}/${encodedKey}`);
  const headers = await signedR2PutHeaders(config, {
    body,
    contentType,
    host: url.host,
    path: url.pathname,
  });
  const response = await fetch(url, {
    body: toBodyInit(body),
    headers,
    method: "PUT",
  });

  if (!response.ok) {
    const message = await response.text().catch(() => "");
    throw new Error(`R2 upload failed (${response.status}): ${message.slice(0, 300)}`);
  }

  return {
    publicUrl: `${config.publicUrl}/${encodedKey}`,
  };
}

async function signedR2PutHeaders(
  config: R2Config,
  {
    body,
    contentType,
    host,
    path,
  }: {
    body: Buffer;
    contentType: string;
    host: string;
    path: string;
  },
) {
  const now = new Date();
  const amzDate = toAmzDate(now);
  const dateStamp = amzDate.slice(0, 8);
  const payloadHash = sha256Hex(body);
  const canonicalHeaders = [
    `content-type:${contentType}`,
    `host:${host}`,
    `x-amz-content-sha256:${payloadHash}`,
    `x-amz-date:${amzDate}`,
  ].join("\n");
  const signedHeaders = "content-type;host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = [
    "PUT",
    path,
    "",
    `${canonicalHeaders}\n`,
    signedHeaders,
    payloadHash,
  ].join("\n");
  const credentialScope = `${dateStamp}/${R2_REGION}/${R2_SERVICE}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    sha256Hex(canonicalRequest),
  ].join("\n");
  const signingKey = getSignatureKey(config.secretAccessKey, dateStamp, R2_REGION, R2_SERVICE);
  const signature = hmacHex(signingKey, stringToSign);

  return {
    Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    "Content-Type": contentType,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
  };
}

function toAmzDate(date: Date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function toBodyInit(buffer: Buffer): BodyInit {
  return new Uint8Array(buffer);
}

function sha256Hex(value: Buffer | string) {
  return createHash("sha256").update(value).digest("hex");
}

function hmac(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest();
}

function hmacHex(key: Buffer | string, value: string) {
  return createHmac("sha256", key).update(value).digest("hex");
}

function getSignatureKey(secretAccessKey: string, dateStamp: string, region: string, service: string) {
  const dateKey = hmac(`AWS4${secretAccessKey}`, dateStamp);
  const regionKey = hmac(dateKey, region);
  const serviceKey = hmac(regionKey, service);
  return hmac(serviceKey, "aws4_request");
}
