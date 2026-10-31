"use client";
export default function ErrorPage({
  reset,
}: {
  error: Error;
  reset: () => void;
}) {
  return (
    <div className="panel">
      <h1>Не удалось загрузить страницу</h1>
      <p>Попробуйте снова. Если ошибка повторится, обратитесь к оператору.</p>
      <button onClick={reset}>Повторить</button>
    </div>
  );
}
