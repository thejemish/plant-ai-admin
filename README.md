This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Getting Started

## Environment

Copy `.env.example` to `.env.local` and fill the server-side keys.

BullMQ uses Redis for long-running dataset import and embedding jobs. For local development:

```bash
REDIS_URL=redis://127.0.0.1:6379
```

For gated Hugging Face datasets such as `enalis/LeafNet`:

1. Log in to Hugging Face.
2. Open the dataset page and accept the access/contact-information terms.
3. Create a read token at `https://huggingface.co/settings/tokens`.
4. Set one of these server-only env vars:

```bash
HUGGINGFACE_TOKEN=hf_...
# or
HF_TOKEN=hf_...
# or
HUGGINGFACE_HUB_TOKEN=hf_...
```

Do not put the Hugging Face token in an admin form, client component, mobile app, or job payload.
The import queue only stores dataset metadata; the worker reads the token from env when downloading parquet shards.

### Leaf image storage

By default, imported and uploaded leaf images are stored in the Supabase Storage `leaves` bucket. To keep Supabase Free storage usage low, configure Cloudflare R2 instead:

```bash
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=plant-ai-leaves
R2_PUBLIC_URL=https://assets.example.com
# Optional:
R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
```

`R2_PUBLIC_URL` must be a public bucket URL or custom domain because `leaf_samples.image_url` is used later by embedding jobs and mobile snapshots.

Start Redis with Docker:

```bash
docker compose up -d redis
```

Run the admin server:

```bash
pnpm dev
```

Run the queue worker in a second terminal:

```bash
pnpm worker
```

The Next.js app queues import and embedding jobs. The BullMQ worker processes them outside the web server so large datasets and embeddings do not block or crash the admin UI.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
