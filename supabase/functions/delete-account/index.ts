// Deletes the calling user's account. Runs with the service role on the server;
// the app only ever sends the user's own access token.
import { createClient } from 'npm:@supabase/supabase-js@2';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405);

  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '');
  if (!token) return json({ error: 'Not signed in' }, 401);

  // SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected automatically into every Edge Function.
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Verify the token and find out who is calling — a user can only delete themselves.
  const { data, error: userError } = await admin.auth.getUser(token);
  if (userError || !data.user) return json({ error: 'Not signed in' }, 401);

  const { error } = await admin.auth.admin.deleteUser(data.user.id);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
});
