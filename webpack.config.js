const path = require('path');
const HtmlWebpackPlugin = require('html-webpack-plugin');

module.exports = {
  mode: process.env.NODE_ENV === 'production' ? 'production' : 'development',
  entry: {
    main: './src/frontend/chat/index.tsx',
    xmltv: './src/frontend/xmltv/index.tsx',
  },
  output: {
    path: path.resolve(__dirname, 'dist/static'),
    filename: '[name].js',
    clean: true,
    publicPath: '/static/',
  },
  resolve: {
    extensions: ['.ts', '.tsx', '.js', '.jsx'],
  },
  module: {
    rules: [
      {
        test: /\.(ts|tsx)$/,
        exclude: /node_modules/,
        use: 'babel-loader',
      },
      {
        test: /\.css$/,
        use: ['style-loader', 'css-loader'],
      },
    ],
  },
  optimization: {
    splitChunks: {
      chunks: 'all',
      cacheGroups: {
        vendors: {
          test: /[\\/]node_modules[\\/]/,
          name: 'vendors',
          chunks: 'all',
          priority: 10,
        },
      },
    },
  },
  plugins: [
    new HtmlWebpackPlugin({
      template: './src/frontend/templates/index.html',
      filename: path.resolve(__dirname, 'dist/templates/index.html'),
      chunks: ['vendors', 'main'],
      inject: 'body',
      scriptLoading: 'defer',
    }),
    new HtmlWebpackPlugin({
      template: './src/frontend/templates/xmltv.html',
      filename: path.resolve(__dirname, 'dist/templates/xmltv.html'),
      chunks: ['vendors', 'xmltv'],
      inject: 'body',
      scriptLoading: 'defer',
    }),
  ],
  devtool: process.env.NODE_ENV === 'production' ? false : 'source-map',
  performance: {
    hints: false,
  },
};
