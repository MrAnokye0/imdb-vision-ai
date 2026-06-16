"use client";

import { useState, useRef } from "react";

interface Label {
  name: string;
  confidence: number;
}

export default function TestRekognitionPage() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [labels, setLabels] = useState<Label[]>([]);
  const [error, setError] = useState<string | null>(null);

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setLabels([]);
    setError(null);
    setPreview(URL.createObjectURL(file));
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) return;

    setLoading(true);
    setError(null);
    setLabels([]);

    try {
      const form = new FormData();
      form.append("image", file);

      const res = await fetch("/api/test-rekognition", {
        method: "POST",
        body: form,
      });

      const data = await res.json();

      if (!res.ok || !data.ok) {
        setError(data.error ?? "Something went wrong.");
        return;
      }

      setLabels(data.labels ?? []);
    } catch {
      setError("Network error — make sure the dev server is running.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-2xl mx-auto px-6 py-10 space-y-8">

      <div>
        <h1 className="text-2xl font-extrabold text-slate-900">AWS Rekognition Test</h1>
        <p className="text-slate-500 text-sm mt-1">Upload a product image to see what Rekognition detects.</p>
      </div>

      {/* Form */}
      <form onSubmit={onSubmit} className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5">
        <div className="space-y-2">
          <label className="block text-sm font-semibold text-slate-700">Image</label>
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={onFileChange}
            className="block w-full text-sm text-slate-600
                       file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0
                       file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700
                       hover:file:bg-indigo-100 cursor-pointer"
          />
        </div>

        {/* Preview */}
        {preview && (
          <div className="rounded-xl overflow-hidden border border-slate-200 bg-slate-50 h-48 flex items-center justify-center">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt="Preview" className="max-h-48 max-w-full object-contain" />
          </div>
        )}

        <button
          type="submit"
          disabled={!preview || loading}
          className="w-full py-2.5 rounded-xl text-sm font-semibold text-white
                     bg-indigo-600 hover:bg-indigo-700 transition-colors
                     disabled:bg-slate-200 disabled:text-slate-400"
        >
          {loading ? "Analysing…" : "Run Rekognition"}
        </button>
      </form>

      {/* Loading */}
      {loading && (
        <div className="flex items-center gap-3 text-slate-500 text-sm">
          <div className="w-5 h-5 border-2 border-indigo-300 border-t-indigo-600 rounded-full animate-spin" />
          Sending to AWS Rekognition…
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm font-medium rounded-2xl px-5 py-4">
          ❌ {error}
        </div>
      )}

      {/* Results table */}
      {labels.length > 0 && (
        <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="font-bold text-slate-800">
              Detected Labels
              <span className="ml-2 text-slate-400 font-normal text-sm">({labels.length})</span>
            </h2>
          </div>
          <table className="w-full text-sm">
            <thead className="bg-slate-50 text-xs font-semibold text-slate-500 uppercase tracking-wide">
              <tr>
                <th className="text-left px-6 py-3">Label</th>
                <th className="text-right px-6 py-3">Confidence</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {labels.map((label, i) => (
                <tr key={i} className="hover:bg-slate-50 transition-colors">
                  <td className="px-6 py-3 font-medium text-slate-800">{label.name}</td>
                  <td className="px-6 py-3 text-right tabular-nums font-semibold">
                    <span className={
                      label.confidence >= 90 ? "text-emerald-600" :
                      label.confidence >= 70 ? "text-amber-600" : "text-red-500"
                    }>
                      {label.confidence.toFixed(1)}%
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Empty result */}
      {!loading && !error && labels.length === 0 && preview && (
        <p className="text-center text-slate-400 text-sm">
          No labels yet — click Run Rekognition.
        </p>
      )}

    </div>
  );
}
