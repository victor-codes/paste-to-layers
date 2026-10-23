export default function Pricing() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: 32, width: 320, backgroundColor: '#ffffff', borderRadius: 16, border: '1px solid #e5e7eb', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>
      <span style={{ fontSize: 14, fontWeight: 600, color: '#6366f1', textTransform: 'uppercase', letterSpacing: 1 }}>Pro</span>
      <div style={{ fontSize: 40, fontWeight: 700, color: '#111827' }}>$29</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 14, color: '#4b5563' }}>Unlimited projects</div>
        <div style={{ fontSize: 14, color: '#4b5563' }}>Priority support</div>
        <div style={{ fontSize: 14, color: '#4b5563' }}>Custom domains</div>
      </div>
      <button style={{ padding: '12px 20px', backgroundColor: '#6366f1', color: '#fff', borderRadius: 8, fontSize: 14, fontWeight: 600 }}>Get started</button>
    </div>
  );
}
