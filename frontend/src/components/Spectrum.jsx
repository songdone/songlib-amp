

function Spectrum({ bars = 42 }) {
  return (
    <div className="spectrum" aria-hidden="true">
      {Array.from({ length: bars }, (_, index) => (
        <i key={index} style={{ "--h": `${22 + ((index * 17) % 54)}%` }} />
      ))}
    </div>
  );
}
