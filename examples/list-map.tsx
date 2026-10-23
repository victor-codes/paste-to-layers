const items = [
  { id: 1, title: 'Design review', time: '9:00 AM' },
  { id: 2, title: 'Standup', time: '10:30 AM' },
  { id: 3, title: 'Lunch', time: '12:00 PM' },
];

export default function Schedule() {
  return (
    <ul className="flex flex-col gap-2 p-4 w-72 bg-gray-50 rounded-xl">
      {items.map((item) => (
        <li key={item.id} className="flex items-center justify-between p-3 bg-white rounded-lg">
          <span className="text-sm font-medium text-gray-900">{item.title}</span>
          <span className="text-xs text-gray-500">{item.time}</span>
        </li>
      ))}
    </ul>
  );
}
