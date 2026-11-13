"use client";

import dynamic from "next/dynamic";

const Studio = dynamic(() => import("@/components/Studio"), {
  ssr: false,
  loading: () => (
    <main className="boot">
      <p>Opening the 3D studio…</p>
    </main>
  ),
});

export default function Page() {
  return <Studio />;
}
