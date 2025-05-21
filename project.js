const lightbox = document.getElementById("lightbox");
const lightboxImg = document.getElementById("lightbox-img");
const images = Array.from(document.querySelectorAll(".gallery-grid img"));

let currentIndex = -1;

function showImage(index) {
    if (index >= 0 && index < images.length) {
        currentIndex = index;
        lightboxImg.src = images[currentIndex].src;
        lightbox.classList.remove("hidden");
        document.body.classList.add("lightbox-open");
    }
}

images.forEach((img, i) => {
    img.addEventListener("click", () => {
        showImage(i);
    });
});

lightbox.addEventListener("click", (e) => {
    if (e.target === lightbox || e.target.classList.contains("lightbox-zone")) {
        lightbox.classList.add("hidden");
        lightboxImg.src = "";
        document.body.classList.remove("lightbox-open");
    }
});

document.querySelector(".left-zone").addEventListener("click", (e) => {
    e.stopPropagation();
    showImage(currentIndex - 1);
});

document.querySelector(".right-zone").addEventListener("click", (e) => {
    e.stopPropagation();
    showImage(currentIndex + 1);
});

document.addEventListener("keydown", (e) => {
    if (!lightbox.classList.contains("hidden")) {
        if (e.key === "ArrowRight") {
            showImage(currentIndex + 1);
        } else if (e.key === "ArrowLeft") {
            showImage(currentIndex - 1);
        } else if (e.key === "Escape") {
            lightbox.classList.add("hidden");
            lightboxImg.src = "";
            document.body.classList.remove("lightbox-open");
        }
    }
});

// **Close-Button Event-Listener außerhalb vom keydown!**
document.getElementById("close-lightbox").addEventListener("click", () => {
    lightbox.classList.add("hidden");
    lightboxImg.src = "";
    document.body.classList.remove("lightbox-open");
});
