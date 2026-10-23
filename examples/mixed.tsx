export default function Mixed() {
  return (
    <div className="flex flex-col gap-3 p-6 w-96 bg-white rounded-xl hover:bg-gray-50 md:p-8">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Mixed styling</h3>
      <p className="text-sm text-gray-600">
        Plain text with <b>bold</b> inline content.
      </p>
      <div style={{ display: 'flex', gap: 8, padding: 12, backgroundColor: '#fef3c7', borderRadius: 8 }} className="items-center">
        <span style={{ fontSize: 13, color: '#92400e' }}>Inline style and Tailwind together</span>
      </div>
      <img src="avatar.png" className="w-12 h-12 rounded-full" alt="avatar" />
    </div>
  );
}
