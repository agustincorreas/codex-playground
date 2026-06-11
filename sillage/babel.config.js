// babel-preset-expo (SDK 50+) incluye automáticamente el plugin de
// worklets/reanimated cuando el paquete está instalado: no declararlo
// acá evita el error "Babel plugin moved to react-native-worklets".
module.exports = function (api) {
  api.cache(true);
  return {
    presets: ['babel-preset-expo'],
  };
};
