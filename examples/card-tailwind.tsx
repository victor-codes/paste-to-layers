export default function Card() {
  return (
    <div className="flex flex-col gap-4 p-6 w-80 bg-white rounded-2xl shadow-lg border border-gray-200">
      <div className="w-full h-32 bg-gray-200 rounded-xl" />
      <h2 className="text-xl font-bold text-gray-900">Mountain retreat</h2>
      <p className="text-sm text-gray-500 leading-relaxed">A quiet cabin with a view of the valley.</p>
      <div className="flex items-center justify-between">
        <span className="text-lg font-semibold text-indigo-600">$240</span>
        <button className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg">Book now</button>
      </div>
    </div>
  );
}
