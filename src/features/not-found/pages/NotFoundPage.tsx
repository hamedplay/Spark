import { Home } from 'lucide-react';
import { useInteractiveNotFoundScene } from '../hooks/useInteractiveNotFoundScene';
import '../styles/notFoundPage.css';

const CASE_NOTES = [
  ['12%', '24%', 'بررسی شد'],
  ['76%', '18%', 'اینجا نیست'],
  ['28%', '68%', 'ردی پیدا نشد'],
  ['84%', '62%', 'مسیر اشتباه'],
  ['54%', '84%', '404'],
  ['9%', '54%', 'جست‌وجو شد'],
  ['66%', '42%', 'خالی'],
] as const;

export default function NotFoundPage() {
  const sceneRef = useInteractiveNotFoundScene();

  return (
    <main className="spark-404" dir="rtl">
      <section
        ref={sceneRef}
        className="spark-404__scene"
        aria-label="صحنه تعاملی صفحه پیدا نشد"
      >
        <div className="spark-404__paper" aria-hidden="true" />
        <div className="spark-404__number spark-404__number--base" aria-hidden="true">404</div>

        <div className="spark-404__found" aria-hidden="true">
          <div className="spark-404__found-inner">
            <div className="spark-404__number spark-404__number--found">404</div>
            {CASE_NOTES.map(([left, top, text]) => (
              <span
                key={`${left}-${top}`}
                className="spark-404__note"
                style={{ left, top }}
              >
                {text}
              </span>
            ))}
          </div>
        </div>

        <div className="spark-404__dust" aria-hidden="true">
          {Array.from({ length: 8 }, (_, index) => <i key={index} />)}
        </div>

        <div className="spark-404__floor" data-spark-404-floor aria-hidden="true" />
        <div className="spark-404__ground" aria-hidden="true" />

        <div className="spark-404__bird" data-spark-404-bird aria-hidden="true">
          <svg viewBox="0 0 180 210" role="presentation">
            <ellipse className="spark-404__shadow" cx="90" cy="199" rx="46" ry="7" />

            <g className="spark-404__leg spark-404__leg--back">
              <path d="M79 158 L72 187 L59 198" />
              <path d="M59 198 L48 200 M59 198 L66 203" />
            </g>
            <g className="spark-404__leg spark-404__leg--front">
              <path d="M103 158 L108 188 L122 198" />
              <path d="M122 198 L112 201 M122 198 L130 203" />
            </g>

            <path className="spark-404__tail" d="M47 119 L18 103 L34 133 L20 151 L55 150 Z" />
            <ellipse className="spark-404__body" cx="87" cy="125" rx="49" ry="55" />
            <circle className="spark-404__head" cx="102" cy="79" r="39" />

            <path className="spark-404__hat-brim" d="M67 57 Q101 43 139 58" />
            <path className="spark-404__hat" d="M79 53 Q82 26 111 23 Q127 31 126 51 Q102 45 79 53 Z" />
            <path className="spark-404__beak" d="M136 82 L166 91 L136 99 Z" />

            <circle className="spark-404__eye-white" cx="119" cy="73" r="11" />
            <circle className="spark-404__pupil" cx="119" cy="73" r="4.5" />
            <circle className="spark-404__eye-glint" cx="117" cy="70" r="1.7" />

            <path className="spark-404__wing" d="M81 112 Q123 104 126 142 Q111 166 78 147 Q91 135 81 112 Z" />
            <path className="spark-404__wing-mark" d="M93 129 Q107 119 117 130 Q109 142 96 139" />
          </svg>
        </div>

        <div className="spark-404__arm" aria-hidden="true" />

        <div className="spark-404__lens" data-spark-404-lens aria-hidden="true">
          <span className="spark-404__lens-handle" />
          <span className="spark-404__lens-glass" />
          <span className="spark-404__lens-ring" />
        </div>

        <div className="spark-404__speech" aria-hidden="true">اینجا هم نیست!</div>
      </section>

      <section className="spark-404__copy">
        <p className="spark-404__eyebrow">ردی از این صفحه پیدا نشد</p>
        <h1>صفحه پیدا نشد</h1>
        <p className="spark-404__description">
          آدرسی که وارد کرده‌اید در سامانه اسپارک وجود ندارد یا جابه‌جا شده است.
        </p>
        <a className="spark-404__home" href="/">
          <Home size={18} aria-hidden="true" />
          بازگشت به سامانه
        </a>
        <p className="spark-404__hint">
          نشانگر را روی صفحه حرکت دهید؛ ذره‌بین و کارآگاه دنبالش می‌آیند.
        </p>
      </section>
    </main>
  );
}
