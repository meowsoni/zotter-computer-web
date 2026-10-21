---
title: Development PCBs are here
date: 2026-10-14
author: Siddharth Soni
excerpt: The first prototypes of the Zotter53 PCB have arrived from JLCPCB — 53 keys, RP2040 chip, MicroUSB power. Here's me soldering the 1N4148 diodes to the front of one of them.
---

The first prototypes of the PCB have arrived from JLCPCB today, and here's one of them pictured at the workshop after I soldered the 1N4148 diodes to them. These are for a development and testing setup, for the first model to be called Zotter53, which has a matrix of 53 keys, scanned by the indefatigable RP2040 chip which I picked up at the Raspberry Pi store in Cambridge. I should perhaps explain in a separate post why I am going ahead with this particular layout, and what charms me personally about it.

While it is somewhat irritating that Pico is powered by the dated MicroUSB port, this is only for testing right now. The final product would sensibly have a USB-C power input as that's the cable we all carry. To reduce complexity as well as the bill of materials, I would like to integrate the circuitry to drive the RP2040 chip right into the Baseboard itself, with a separate I/O board providing three connections: USB-C port for power, an RJ12 port for serial communication (more on this below), and a Reverse Polarity SubMiniature A (RP-SMA) female jack for LoRa, which I am learning more about.

![Soldering 1N4148 diodes onto the Zotter53 PCB](/assets/images/zotter53-pcb-soldering.jpeg)

LoRa might enable the device to send and receive radio text messages in a 10km radius all while being off the internet grid. I can see some interesting usage scenarios for this, such as local writing clubs, classrooms, reaching out to someone who has left their phone at home? Not sure if that runs contra the soul of the Zotter project, or if that is something that can allow someone to be truly off-grid? Something to ponder.

On the PCB you can probably also see an IDC header (pitch 2.54mm) with 16 pins (2x8 arrangement). This breaks out the I/O for the Waveshare 4.2' Reflective LCD display module I am currently (and begrudgingly) using into a 4-pin UART for serial video console input (so Zotter can act as an ANSI escape sequence interpreter over the RJ12 port). It also mates the TX/RX pins to the outputs of the matrix-scanning RP2040 chip in order to receive keystrokes asynchronously over UART.

One of the advantages of using a Pico for keyboard scanning is that it outputs a 5V power rail if you mate the controller's VBUS to the peripheral's VBUS, while at the same time retaining 3.3V logic for all the UART communications. This makes it convenient for working with development boards like the Waveshare RLCD, which have additional onboard components that draw power whether or not you use them. Since the display is currently controlled by an ESP32-S3 operating at 3.3V logic levels, the two boards can communicate without a separate buck converter: Pico's VBUS is mated to Waveshare RLCD's VBUS while the rest of the logic is tranmitted using the TX/RX pair.

Now, I am off to Southampton to do my lectures for this week—on the development of psychological realism in the novels of Henry James!—but I can't wait to come back and flash the excellent open-source QMK firmware onto the board to see if it works. I am particularly interested in comparing input and debounce latency, as well as establishing a pattern of electrical activity between idle and active use. One of my personal targets for the Zotter project is to have a battery life that's counted in months rather than days; it makes it crucial to understand where all the current is going. My search, meanwhile, for a raw reflective display panel that is 9 inches or more, also continues, as the power draw of the Waveshare module, which is only 4.2', is not a longterm solution, though it does make for a cute-looking device, which one of my colleagues called 'Mickey Mouse Computer' - not sure how I feel about that!
