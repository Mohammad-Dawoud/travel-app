module.exports = (api) => {
  const testing = api.env('test');
  return {
    presets: [
      [
        '@babel/preset-env',
        {
          targets: testing
            ? { node: '24' }
            : { chrome: '110', firefox: '115', safari: '17' },
          modules: testing ? 'commonjs' : false,
        },
      ],
    ],
  };
};
