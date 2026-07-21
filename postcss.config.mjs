const removeTextureUrl = () => {
  return {
    postcssPlugin: 'remove-texture-url',
    Once(root) {
      root.walkDecls('background-image', (decl) => {
        if (decl.value && decl.value.includes('texture-btn.png')) {
          decl.value = decl.value.replace(/url\([^)]*texture-btn\.png[^)]*\)\s*,?\s*/, '');
          if (!decl.value.trim()) {
            decl.remove();
          }
        }
      });
    },
  };
};
removeTextureUrl.postcss = true;

const config = {
  plugins: [
    "@tailwindcss/postcss",
    removeTextureUrl,
  ],
};

export default config;
