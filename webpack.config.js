const webpack = require('webpack');
const package = require('./package.json');
const LodashModuleReplacementPlugin = require('lodash-webpack-plugin');

const rules = [{
    test: /\.js$/,
    loader: 'babel-loader',
    options: {
        presets: [
            ['es2015', {
                modules: false
            }], 'stage-0'
        ],
        plugins: ['lodash']
    }
}];

const plugins = [
    new webpack.LoaderOptionsPlugin({
        minimize: true,
        debug: false
    }),
    new LodashModuleReplacementPlugin(),
    new webpack.optimize.UglifyJsPlugin({
        sourceMap: true,
        compress: {
            warnings: false,
            screw_ie8: true,
            conditionals: true,
            unused: true,
            comparisons: true,
            sequences: true,
            dead_code: true,
            evaluate: true,
            join_vars: true,
            if_return: true
        },
        output: {
            comments: false
        }
    })
];

module.exports = function (env) {
    const config = {
        devtool: env.prod ? 'source-map' : 'inline-source-map',
        entry: './index.js',
        output: {
            path: './dist',
            filename: `${package.name}.${env.prod ? 'min': ''}.js`
        },
        module: {
            rules: rules
        }
    }

    env.prod && (config.plugins = plugins);

    return config;
};