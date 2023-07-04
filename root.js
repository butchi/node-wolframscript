console.log("Hello, world!")

const mainElm = document.querySelector("main")
const nbElm = document.querySelector("#nb")

let inputTmpl = document.querySelector("#input")
let outputTmpl = document.querySelector("#output")

let inputClone = inputTmpl.content.firstElementChild.cloneNode(true)
let inputElm = nbElm.appendChild(inputClone)

const contentClone = document.querySelector("#container").content.firstElementChild.cloneNode(true)
contentClone.querySelector("[data-slot]").appendChild(mainElm)
document.body.appendChild(contentClone)

const evaluate = async ({ action } = { action: "vector" }) => {
    const input = inputElm.querySelector("textarea").value

    inputElm.querySelector("textarea").disabled = true

    let cmd = input

    if (action == null) {
    } else if (action === "text") {
        cmd = input
    } else if (action === "mathml") {
        cmd = `ExportString[${input}, "MathML"]`
    } else if (action === "raster") {
        cmd = `ExportString[${input}, {"Base64", "PNG"}]`
    } else if (action === "vector") {
        cmd = `ExportString[${input}, {"Base64", "SVG"}]`
    } else if (action === "audio") {
        cmd = `ExportString[${input}, {"Base64", "MP3"}]`
    } else {
    }

    const res = await fetch(`/wolfram/exec?command=${encodeURIComponent(cmd)}`)

    const output = await res.text()

    console.log(output)

    outputClone = outputTmpl.content.firstElementChild.cloneNode(true)

    if (action == null) {
        outputClone.innerHTML = output
    } else if (action === "mathml") {
        outputClone.innerHTML = `<p>${output}</p>`
    } else if (action === "raster") {
        outputClone.innerHTML = `<img src="data:image/png;base64,${output}" alt="output">`
    } else if (action === "vector") {
        outputClone.innerHTML = `<img src="data:image/svg+xml;base64,${output}" alt="output">`
    } else if (action === "audio") {
        outputClone.innerHTML = `<audio controls><source type="audio/mpeg" src="data:audio/mpeg;base64,${output}"></source>`
    } else {
        outputClone.innerHTML = output
    }

    nbElm.appendChild(outputClone)

    inputClone = inputTmpl.content.firstElementChild.cloneNode(true)
    inputElm = nbElm.appendChild(inputClone)

    inputElm.querySelector("textarea").focus()
}

globalThis.addEventListener("keydown", async evt => {
    if (evt.shiftKey && (evt.key === "Enter")) {
        evt.preventDefault()

        evaluate()
    }
})

document.querySelector(`[data-action="text"]`).addEventListener("click", _ => {
    evaluate({ action: "text" })
})

document.querySelector(`[data-action="mathml"]`).addEventListener("click", _ => {
    evaluate({ action: "mathml" })
})

document.querySelector(`[data-action="raster"]`).addEventListener("click", _ => {
    evaluate({ action: "raster" })
})

document.querySelector(`[data-action="vector"]`).addEventListener("click", _ => {
    evaluate({ action: "vector" })
})

document.querySelector(`[data-action="audio"]`).addEventListener("click", _ => {
    evaluate({ action: "audio" })
})

console.log("Thanks, world!")
