/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        xl: '0.85rem',
        '2xl': '1.15rem',
      },
      boxShadow: {
        soft: '0 10px 30px -18px rgba(15, 23, 42, 0.35)',
        panel: '0 20px 50px -30px rgba(15, 23, 42, 0.45)',
      },
      colors: {
        // Azul Navy del logo - Color principal
        primary: {
          50: '#e8eaf6',   // Azul muy claro
          100: '#c5cae9',  // Azul lavanda
          200: '#9fa8da',  // Azul claro
          300: '#7986cb',  // Azul medio
          400: '#3949ab',  // Azul vibrante
          500: '#0a1d3d',  // Navy del logo ⭐
          600: '#081628',  // Navy oscuro
          700: '#061019',  // Navy muy oscuro
          800: '#040b0f',  // Casi negro azulado
          900: '#020507',  // Negro azulado
        },
        // Amarillo Dorado del logo - Color secundario/acento
        secondary: {
          50: '#fffbeb',   // Amarillo muy claro
          100: '#fef3c7',  // Amarillo pastel
          200: '#fde68a',  // Amarillo suave
          300: '#fcd34d',  // Amarillo medio
          400: '#fbbf24',  // Amarillo vibrante
          500: '#f59e0b',  // Dorado del logo ⭐
          600: '#d97706',  // Dorado oscuro
          700: '#b45309',  // Ámbar
          800: '#92400e',  // Ámbar oscuro
          900: '#78350f',  // Ámbar muy oscuro
        },
        brand: {
          50: '#eef4ff',
          100: '#dce7ff',
          200: '#bfd2ff',
          300: '#93b3ff',
          400: '#5c8cff',
          500: '#2f67f6',
          600: '#1f4ed8',
          700: '#1d3ea8',
          800: '#1f3a7a',
          900: '#1d325f',
        },
      },
    },
  },
  plugins: [],
}
