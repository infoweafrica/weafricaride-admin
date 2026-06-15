"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Image as ImageIcon, Plus, RefreshCw, Trash2 } from "lucide-react";

type Banner = {
  id: string; title: string; subtitle: string | null; image_url: string | null; target_city: string | null;
  click_action: string | null; starts_at: string | null; ends_at: string | null; is_active: boolean; created_at: string;
};

const inputClass = "w-full rounded-xl border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm outline-none focus:border-orange-400";

export default function MarketingBannersPage() {
  const [items, setItems] = useState<Banner[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [title, setTitle] = useState("Airport Rides Available");
  const [subtitle, setSubtitle] = useState("Book reliable airport trips with WeAfrica Ride.");
  const [imageUrl, setImageUrl] = useState("");
  const [city, setCity] = useState("");
  const [action, setAction] = useState("booking");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");

  const load = async () => {
    setLoading(true);
    const { data } = await supabase.from("marketing_banners").select("*").order("created_at", { ascending: false }).limit(100);
    setItems((data || []) as Banner[]);
    setLoading(false);
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    if (!title.trim()) return;
    setSaving(true);
    const { error } = await supabase.from("marketing_banners").insert({
      title: title.trim(), subtitle: subtitle.trim() || null, image_url: imageUrl.trim() || null,
      target_city: city.trim() || null, click_action: action, starts_at: startsAt ? new Date(startsAt).toISOString() : null,
      ends_at: endsAt ? new Date(endsAt).toISOString() : null, is_active: true,
    });
    setSaving(false);
    if (error) return alert(error.message);
    setTitle(""); setSubtitle(""); setImageUrl(""); setCity(""); setAction("booking"); setStartsAt(""); setEndsAt("");
    load();
  };

  const toggle = async (banner: Banner) => {
    await supabase.from("marketing_banners").update({ is_active: !banner.is_active, updated_at: new Date().toISOString() }).eq("id", banner.id);
    load();
  };

  const remove = async (id: string) => {
    if (!confirm("Delete this banner?")) return;
    await supabase.from("marketing_banners").delete().eq("id", id);
    load();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between"><div><h1 className="text-2xl font-black text-zinc-900">In-App Banners</h1><p className="text-sm text-zinc-500">Publish customer home-screen banners by city and date range.</p></div><button onClick={load} className="inline-flex items-center gap-2 rounded-xl border bg-white px-4 py-2 text-sm font-bold"><RefreshCw className="h-4 w-4"/>Refresh</button></div>
      <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
        <div className="rounded-2xl border bg-white p-5 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 font-black"><Plus className="h-4 w-4 text-orange-600"/>Create Banner</h2>
          <div className="space-y-3">
            <Field label="Title"><input className={inputClass} value={title} onChange={(e)=>setTitle(e.target.value)} /></Field>
            <Field label="Subtitle"><textarea className={inputClass} rows={3} value={subtitle} onChange={(e)=>setSubtitle(e.target.value)} /></Field>
            <Field label="Banner Image URL"><input className={inputClass} value={imageUrl} onChange={(e)=>setImageUrl(e.target.value)} placeholder="https://..." /></Field>
            <div className="grid grid-cols-2 gap-3"><Field label="Target City"><input className={inputClass} value={city} onChange={(e)=>setCity(e.target.value)} placeholder="All cities" /></Field><Field label="Click Action"><select className={inputClass} value={action} onChange={(e)=>setAction(e.target.value)}><option value="booking">Book Ride</option><option value="referral">Referral</option><option value="promos">Promo Codes</option><option value="wallet">Rewards Wallet</option><option value="support">Support</option></select></Field></div>
            <div className="grid grid-cols-2 gap-3"><Field label="Start"><input type="datetime-local" className={inputClass} value={startsAt} onChange={(e)=>setStartsAt(e.target.value)} /></Field><Field label="End"><input type="datetime-local" className={inputClass} value={endsAt} onChange={(e)=>setEndsAt(e.target.value)} /></Field></div>
            <button onClick={save} disabled={saving || !title.trim()} className="w-full rounded-xl bg-orange-600 py-3 text-sm font-black text-white disabled:opacity-50">{saving ? "Saving..." : "Publish Banner"}</button>
          </div>
        </div>
        <div className="grid gap-3">
          {loading ? <div className="rounded-2xl border bg-white p-8 text-center text-zinc-400">Loading...</div> : items.length === 0 ? <div className="rounded-2xl border bg-white p-8 text-center text-zinc-400">No banners yet.</div> : items.map((b)=>(
            <div key={b.id} className="rounded-2xl border bg-white p-4 shadow-sm">
              <div className="flex items-start gap-4">
                <div className="flex h-20 w-28 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-zinc-100 bg-cover bg-center" style={b.image_url ? { backgroundImage: `url(${b.image_url})` } : undefined}>{!b.image_url && <ImageIcon className="h-6 w-6 text-zinc-400"/>}</div>
                <div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="font-black text-zinc-900">{b.title}</h3><span className={`rounded-full px-2 py-0.5 text-xs font-bold ${b.is_active ? "bg-orange-100 text-orange-700" : "bg-zinc-100 text-zinc-500"}`}>{b.is_active ? "Active" : "Inactive"}</span></div><p className="mt-1 text-sm text-zinc-500">{b.subtitle || "No subtitle"}</p><p className="mt-2 text-xs text-zinc-400">{b.target_city || "All cities"} · {b.click_action || "home"} · {b.ends_at ? `Ends ${new Date(b.ends_at).toLocaleDateString()}` : "No end date"}</p></div>
                <div className="flex gap-1"><button onClick={()=>toggle(b)} className="rounded-lg bg-zinc-100 px-3 py-2 text-xs font-bold">{b.is_active ? "Disable" : "Enable"}</button><button onClick={()=>remove(b.id)} className="rounded-lg bg-zinc-100 p-2 text-zinc-800"><Trash2 className="h-4 w-4"/></button></div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="block"><span className="mb-1 block text-xs font-bold text-zinc-600">{label}</span>{children}</label>; }
