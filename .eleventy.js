module.exports = function(eleventyConfig) {
  eleventyConfig.addPassthroughCopy('logo.png');
  eleventyConfig.addPassthroughCopy('styles.css');
  eleventyConfig.addPassthroughCopy('assets');

  eleventyConfig.addCollection('blogPosts', collection => {
    return collection.getFilteredByGlob('./blog/*.md').reverse();
  });

  return {
    dir: {
      input: '.',
      output: '_site',
      includes: '_includes'
    }
  };
};
