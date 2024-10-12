from PIL import Image

TILES_ACROSS = 16
TILES_DOWN = 6

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
	glyph_width = image_width // TILES_ACROSS
	glyph_height = image_height // TILES_DOWN

	width_per_character = []

	for tile_y in range(TILES_DOWN):
		for tile_x in range(TILES_ACROSS):
			source_x = tile_x * glyph_width
			source_y = tile_y * glyph_height
			glyph_pixels = im.crop((source_x, source_y, source_x + glyph_width, source_y + glyph_height)).getdata()

			leftmost_x = 999
			rightmost_x = -999
			for pixel_y in range(glyph_height):
				for pixel_x in range(glyph_width):
					pixel = glyph_pixels[pixel_y*glyph_width+pixel_x]
					if pixel == PAPER_PIXEL or pixel == INK_PIXEL or pixel == BORDER_AND_PAPER:
						leftmost_x = min(pixel_x, leftmost_x)
						rightmost_x = max(pixel_x, rightmost_x)
			width_per_character.append(rightmost_x-leftmost_x+1)

	print(width_per_character)

	im.close()

process_font("tilemap_sans_bold.png")
