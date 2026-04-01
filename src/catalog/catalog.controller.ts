import { Controller, Get, Param, Query } from "@nestjs/common";

import { CatalogService } from "./catalog.service";
import { CatalogProductsQueryDto } from "./dto/catalog-products-query.dto";

@Controller("catalog")
export class CatalogController {
  constructor(private readonly catalogService: CatalogService) {}

  @Get("categories")
  getCategories() {
    return this.catalogService.fetchCategories();
  }

  @Get("subcategories")
  getSubcategories(@Query("categoryId") categoryId?: string) {
    return this.catalogService.fetchSubcategories(categoryId);
  }

  @Get("products")
  getProducts(@Query() query: CatalogProductsQueryDto) {
    return this.catalogService.fetchProducts(query);
  }

  @Get("products/:id")
  getProductById(@Param("id") id: string) {
    return this.catalogService.fetchProductById(id);
  }
}

