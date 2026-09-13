// ============================================================
// Supabase configuration
// ------------------------------------------------------------
// 1. Create a free project at https://supabase.com
// 2. In your project, go to Project Settings -> API
// 3. Copy your "Project URL" and the "anon public" key below.
//
// The anon key is MEANT to be public and shipped in client-side
// code — Supabase's Row Level Security (RLS) policies (see
// schema.sql) are what actually keep each user's data private.
//
// NEVER put your "service_role" key here, or in any file the
// browser loads — that key bypasses RLS entirely and must only
// ever be used from a trusted server.
// ============================================================
const SUPABASE_URL = 'https://tjjzeetbsxnkrgoiagbf.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_xe57WzdPG-A2r6pKx-_EEg_hqGDdqye';