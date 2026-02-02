/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        google: {
          blue: '#4285F4',
          red: '#EA4335',
          yellow: '#FBBC05',
          green: '#34A853',
        },
        m3: {
          surface: '#F8F9FA',
          'surface-container': '#F3F6FC',
          'surface-container-high': '#E8EAED',
          'on-surface': '#1F1F1F',
          'on-surface-variant': '#444746',
          outline: '#747775',
          'outline-variant': '#C4C7C5',
          primary: '#0B57D0',
          'on-primary': '#FFFFFF',
          'primary-container': '#D3E3FD',
          'on-primary-container': '#041E49',
          secondary: '#C2E7FF',
          'on-secondary': '#001D35',
          'secondary-container': '#C2E7FF',
          'on-secondary-container': '#001D35',
        }
      },
      fontFamily: {
        sans: ['"Google Sans"', 'Roboto', 'Arial', 'sans-serif'],
        display: ['"Google Sans Display"', 'Roboto', 'Arial', 'sans-serif'],
      },
      boxShadow: {
        'elevation-1': '0px 1px 2px 0px rgba(0, 0, 0, 0.3), 0px 1px 3px 1px rgba(0, 0, 0, 0.15)',
        'elevation-2': '0px 1px 2px 0px rgba(0, 0, 0, 0.3), 0px 2px 6px 2px rgba(0, 0, 0, 0.15)',
        'elevation-3': '0px 4px 8px 3px rgba(0, 0, 0, 0.15), 0px 1px 3px 0px rgba(0, 0, 0, 0.3)',
      }
    },
  },
  plugins: [],
  darkMode: 'class', // 这一行是为了支持你的深色模式设置
}