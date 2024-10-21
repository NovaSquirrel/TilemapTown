from PIL import Image

def process_font(filename):
	print(filename)
	VOID_PIXEL = (255, 0, 255)
	BORDER_PIXEL = (0, 255, 0)
	PAPER_PIXEL = (255, 255, 255)
	INK_PIXEL = (0, 0, 0)
	BORDER_AND_PAPER = (0, 128, 0)

	im = Image.open(filename)

	pixels = list(im.getdata())
	image_width, image_height = im.size

	glyph_width = 14
	glyph_height = 16
	tiles_across = image_width // glyph_width
	tiles_down = image_height // glyph_height

	width_per_character = []

	for tile_y in range(tiles_down):
		for tile_x in range(tiles_across):
			have_void = False
			source_x = tile_x * glyph_width
			source_y = tile_y * glyph_height
			glyph_pixels = im.crop((source_x, source_y, source_x + glyph_width, source_y + glyph_height)).getdata()

			leftmost_x = 999
			rightmost_x = -999
			for pixel_y in range(glyph_height):
				for pixel_x in range(glyph_width):
					pixel = glyph_pixels[pixel_y*glyph_width+pixel_x]
					if pixel == VOID_PIXEL:
						have_void = True
					if pixel == PAPER_PIXEL or pixel == INK_PIXEL or pixel == BORDER_AND_PAPER:
						leftmost_x = min(pixel_x, leftmost_x)
						rightmost_x = max(pixel_x, rightmost_x)
			if have_void:
				width_per_character.append(rightmost_x-leftmost_x+1)
			else:
				width_per_character.append(-1)

	print(width_per_character)

	im.close()

process_font("tilemap_sans_bold.png")
