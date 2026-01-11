<template>
  <h1 class="text-3xl font-bold underline">
    Hello world! <br>
    <button class="btn">Button</button>
  </h1>
  <!-- app.vue or layouts/default.vue -->
  <div>
    <header class="p-4 flex justify-between items-center">
      <h1 class="text-xl font-bold">Nuxt + daisyUI</h1>
      <ThemeSwitcher />
    </header>
    <main class="p-4">
      <NuxtPage />
      <!-- Example daisyUI component to show the theme change working -->
      <button class="btn btn-primary mt-4">Primary Button</button>
      <div class="card w-96 bg-base-100 shadow-xl mt-4">
        <div class="card-body">
          <h2 class="card-title">Card title!</h2>
          <p>If a dog chews shoes whose shoes does he choose?</p>
        </div>
      </div>
    </main>
  </div>

</template>