export const theme = {
  colors: {
    // Backdrop gradients
    bgGradient: ['#0F0C20', '#15102A', '#201335'],
    
    // Blobs colors
    blob1: 'rgba(124, 58, 237, 0.25)', // purple-600 radial
    blob2: 'rgba(168, 85, 247, 0.2)',  // purple-500 radial
    
    // Glass card styling
    glassBg: 'rgba(255, 255, 255, 0.05)',
    glassBorder: 'rgba(255, 255, 255, 0.1)',
    glassShadow: 'rgba(0, 0, 0, 0.4)',
    
    // Inputs & focus states
    inputBg: 'rgba(255, 255, 255, 0.05)',
    inputBorder: 'rgba(255, 255, 255, 0.1)',
    inputBorderActive: '#A855F7', // purple-500
    inputText: '#FFFFFF',
    inputPlaceholder: 'rgba(216, 180, 254, 0.4)', // purple-300 with opacity
    inputIcon: 'rgba(216, 180, 254, 0.4)',
    
    // Text primary & accent colors
    textPrimary: '#FFFFFF',
    textSecondary: 'rgba(216, 180, 254, 0.5)', // purple-300/50
    textMuted: 'rgba(216, 180, 254, 0.3)',     // purple-300/30
    labelPurple: '#D8B4FE',                     // purple-300
    accentPurple: '#C084FC',                    // purple-400
    
    // Button gradients
    btnGradient: ['#7C3AED', '#5B21B6'], // purple-600 to purple-800
    btnGradientHover: ['#8B5CF6', '#6D28D9'], // purple-500 to purple-700
    
    // Error banner
    errorBg: 'rgba(239, 68, 68, 0.1)',     // red-500/10
    errorBorder: 'rgba(239, 68, 68, 0.2)', // red-500/20
    errorText: '#FECACA',                  // red-200
  },
  fonts: {
    regular: 'Inter-Regular',
    medium: 'Inter-Medium',
    bold: 'Inter-Bold',
    extrabold: 'Inter-ExtraBold',
  }
} as const;
