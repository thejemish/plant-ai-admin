# Supabase Backend

This folder contains the backend data contract for the Plant-AI Supabase project.

Apply in order:

1. `admin/supabase/migrations/20260508090000_backend_schema.sql`

The schema creates content tables, user-owned tables, admin tables, storage buckets, RLS helpers, and storage policies for the admin project and Expo app.

After applying the schema, use the Supabase service role or SQL editor to add the first row in `admin_users`. The service role must stay server-only and must never be exposed to the browser or mobile app.
