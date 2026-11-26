const { readFileSync } = require('node:fs');
const path = require('node:path');
const { DefinePlugin } = require('webpack');
const HtmlWebpackPlugin = require('html-webpack-plugin');
const MiniCssExtractPlugin = require('mini-css-extract-plugin');

const dist = path.join(__dirname, 'dist');
module.exports = [
  {
    name: 'client',
    mode: 'production',
    entry: './src/client/index.js',
    output: { path: dist, filename: 'app.js', clean: true },
    module: {
      rules: [
        { test: /\.js$/, exclude: /node_modules/, loader: 'babel-loader' },
        {
          test: /\.scss$/,
          use: [
            MiniCssExtractPlugin.loader,
            {
              loader: 'css-loader',
              options: {
                url: { filter: (url) => !url.startsWith('/assets/') },
              },
            },
            { loader: 'sass-loader', options: { api: 'modern' } },
          ],
        },
      ],
    },
    plugins: [
      new MiniCssExtractPlugin({ filename: 'app.css' }),
      new HtmlWebpackPlugin({ template: './src/client/views/index.html' }),
    ],
  },
  {
    name: 'worker',
    mode: 'production',
    target: 'webworker',
    entry: './src/client/service-worker.js',
    output: { path: dist, filename: 'service-worker.js' },
    plugins: [
      new DefinePlugin({
        PRECACHE_MANIFEST: DefinePlugin.runtimeValue(
          () =>
            readFileSync(
              path.join(__dirname, '.local/precache-manifest.json'),
              'utf8',
            ),
          true,
        ),
      }),
    ],
  },
];
