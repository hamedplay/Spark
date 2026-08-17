interface SparkLoaderProps {
  message?: string;
  fullScreen?: boolean;
  compact?: boolean;
}

export function SparkLoader({
  message = 'در حال بارگذاری...',
  fullScreen = true,
  compact = false,
}: SparkLoaderProps) {
  return (
    <div
      className={`spark-loader ${fullScreen ? 'spark-loader--fullscreen' : 'spark-loader--embedded'} ${compact ? 'spark-loader--compact' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={message}
      dir="rtl"
    >
      <div className="spark-loader__ambient" aria-hidden="true" />
      <div className="spark-loader__stage">
        <div className="spark-loader__orbital" aria-hidden="true">
          <span className="spark-loader__ring spark-loader__ring--outer" />
          <span className="spark-loader__ring spark-loader__ring--middle" />
          <span className="spark-loader__ring spark-loader__ring--inner" />
          <span className="spark-loader__dots" />
          <span className="spark-loader__spark spark-loader__spark--one" />
          <span className="spark-loader__spark spark-loader__spark--two" />
          <span className="spark-loader__spark spark-loader__spark--three" />
        </div>

        <div className="spark-loader__core">
          <div className="spark-loader__logo-wrap">
            <img
              src="/logo_spark.png"
              alt="Spark"
              className="spark-loader__logo"
              draggable={false}
            />
          </div>
          <span className="spark-loader__brand" aria-hidden="true">SPARK</span>
        </div>
      </div>

      <div className="spark-loader__message">
        <span className="spark-loader__message-text">{message}</span>
        <span className="spark-loader__typing" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
      </div>
    </div>
  );
}

export default SparkLoader;
