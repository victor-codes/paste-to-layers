export default function IconButton() {
  return (
    <button className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M5 12h14M12 5l7 7-7 7" />
      </svg>
      <span className="text-sm font-medium">Continue</span>
    </button>
  );
}
