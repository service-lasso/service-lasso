module.exports = function replaceResolveWeak(source) {
  return source.replaceAll("require.resolveWeak(", "((moduleId) => moduleId)(");
};
