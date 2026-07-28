'use client';

export default function GlobalError({ reset }: { error: Error; reset: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily: 'system-ui, sans-serif',
          background: '#f2f5f9',
          color: '#14212e',
        }}
      >
        <div
          style={{
            background: '#fff',
            border: '1px solid #d7dfe9',
            borderRadius: 16,
            padding: 32,
            maxWidth: 420,
            textAlign: 'center',
          }}
        >
          <p style={{ margin: 0, fontSize: 11, letterSpacing: 3, color: '#5d6d7e' }}>
            DATA EXCHANGE CORPORATION
          </p>
          <h1 style={{ margin: '8px 0 0', fontSize: 20 }}>Something went wrong</h1>
          <p style={{ color: '#5d6d7e', fontSize: 14, lineHeight: 1.6 }}>
            The app hit an unexpected problem. Your data is safe.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 12,
              background: '#1d5bd8',
              color: '#fff',
              border: 0,
              borderRadius: 10,
              padding: '10px 28px',
              fontSize: 15,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </body>
    </html>
  );
}
