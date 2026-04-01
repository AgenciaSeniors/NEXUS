/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Colores Primarios Nexus
        nexus: {
          dark:    '#1C1917',   // Carbon (sidebar, fondos oscuros)
          primary: '#EA580C',   // Terracota (acento principal)
          light:   '#F97316',   // Naranja claro (hover, acento secundario)
        },
        // Superficies y fondos
        surface: '#FFFFFF',
        background: '#FAFAF9', // Crema (fondo principal)
        'background-secondary': '#F5F5F4', // Stone claro
        // Texto
        text: {
          main:      '#1C1917', // Stone oscuro (legibilidad)
          secondary: '#78716C', // Stone medio (metadatos)
          muted:     '#A8A29E', // Stone (placeholders)
        },
        // Bordes
        border: '#E7E5E4',
        // Estados semánticos
        state: {
          error:   '#DC2626',
          warning: '#F59E0B',
          success: '#16A34A',
          info:    '#2563EB',
        }
      },
      fontFamily: {
        // Poppins para encabezados, logo y navegación
        heading: ['Poppins', 'sans-serif'],
        // Inter para cuerpo y números
        body: ['Inter', 'sans-serif'],
      }
    },
  },
  plugins: [
    function({ addUtilities }) {
      addUtilities({
        '.pt-safe': { 'padding-top': 'env(safe-area-inset-top, 0px)' },
        '.pb-safe': { 'padding-bottom': 'env(safe-area-inset-bottom, 0px)' },
        '.pl-safe': { 'padding-left': 'env(safe-area-inset-left, 0px)' },
        '.pr-safe': { 'padding-right': 'env(safe-area-inset-right, 0px)' },
        '.mt-safe': { 'margin-top': 'env(safe-area-inset-top, 0px)' },
        '.mb-safe': { 'margin-bottom': 'env(safe-area-inset-bottom, 0px)' },
      });
    }
  ],
}