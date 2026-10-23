export default function Navbar() {
  return (
    <nav className="flex items-center justify-between w-[960px] px-8 py-4 bg-slate-900">
      <span className="text-xl font-bold text-white">Acme</span>
      <ul className="flex items-center gap-6">
        <li className="text-sm text-slate-300">Products</li>
        <li className="text-sm text-slate-300">Pricing</li>
        <li className="text-sm text-slate-300">Docs</li>
      </ul>
      <button className="px-4 py-2 bg-emerald-500 text-white text-sm font-semibold rounded-full">Sign up</button>
    </nav>
  );
}
