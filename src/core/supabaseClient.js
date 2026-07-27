import { SUPABASE_URL, SUPABASE_ANON } from "./config.js";

// `supabase` is the global UMD export from the CDN <script> tag in index.html.
export const db = supabase.createClient(SUPABASE_URL, SUPABASE_ANON);
export const FN_URL = SUPABASE_URL + "/functions/v1/carton-sync";

export async function rpc(fn, args){
  const { data, error } = await db.rpc(fn, args);
  if (error) throw new Error(error.message.replace(/^.*?: /,""));
  return data;
}
export async function edgeFn(action, extra = {}){
  const r = await fetch(FN_URL, { method:"POST",
    headers:{ "Content-Type":"application/json", "Authorization":"Bearer "+SUPABASE_ANON, "apikey":SUPABASE_ANON },
    body: JSON.stringify({ action, ...extra }) });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "edge function failed");
  return j;
}
