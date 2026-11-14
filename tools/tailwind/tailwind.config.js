// Tailwind 정적 빌드 설정 — 예전에 각 페이지 <script>에 있던 tailwind.config와 같은 값이다.
// 빌드: tools/tailwind/build.sh  →  assets/v2/tailwind.css
module.exports = {
  content: [
    'index.html', 'en/index.html', 'updates.html', 'data-policy.html',
    'generate.py', 'assets/v2/*.js',
  ],
  theme: {
    extend: {
      fontFamily: {
        serif: ['"KoPubWorld Batang"', 'serif'],
        sans:  ['"Space Grotesk"', '"KoPubWorld Dotum"', 'sans-serif'],
      },
      colors: {
        ink:        'rgb(var(--ink-rgb) / <alpha-value>)',
        black:      'rgb(var(--ink-rgb) / <alpha-value>)',
        paper:      'rgb(var(--bg-rgb) / <alpha-value>)',
        white:      'rgb(var(--bg-rgb) / <alpha-value>)',
        'paper-dark': 'rgb(var(--card-rgb) / <alpha-value>)',
        muted:      'rgb(var(--muted-rgb) / <alpha-value>)',
        'neo-mint':   'rgb(var(--card-rgb) / <alpha-value>)',
        'neo-pink':   'rgb(var(--card-rgb) / <alpha-value>)',
        'neo-yellow': '#fde047',
      },
      borderColor: { ink: 'rgb(var(--border-rgb) / <alpha-value>)' },
      borderWidth: { 2: '1px', 4: '1px' },
      boxShadow: { neo: 'none', 'neo-lg': '0 16px 40px rgb(0 0 0 / .14)', 'neo-sm': 'none' },
      fontWeight: { black: '700', bold: '500' },
      keyframes: {
        fadeIn: {
          '0%':   { opacity: '0', transform: 'translateY(15px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-in':         'fadeIn 0.8s ease-out forwards',
        'fade-in-delayed': 'fadeIn 1s ease-out 0.2s forwards',
        'fade-in-fast':    'fadeIn 0.5s ease-out forwards',
      },
    },
  },
};
