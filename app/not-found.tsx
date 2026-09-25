import Link from "next/link";

// A 404 inside the app shell, rather than Next's unstyled default page.
export default function NotFound() {
  return (
    <div className="grid min-h-full place-items-center bg-graphite px-8 text-white">
      <div className="w-full max-w-[330px] rounded-3xl bg-panel p-6 text-fg shadow-panel">
        <p className="font-golden text-5xl leading-none text-fg-muted">404</p>
        <h1 className="mt-2 font-golden text-2xl leading-none">NOTHING HERE</h1>
        <p className="mt-2.5 text-[13px] font-semibold leading-snug text-fg-soft">
          This page does not exist. It may have been a link from an older version
          of the app.
        </p>
        <Link
          href="/"
          className="mt-5 block w-full rounded-full bg-action py-3.5 text-center font-golden text-[13px] text-on-action transition active:scale-[0.98]"
        >
          BACK TO HOME
        </Link>
      </div>
    </div>
  );
}
